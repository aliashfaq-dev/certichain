import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

const app = express();
async function sendEmail({ to, subject, text, html }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.");
  const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true", auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
}
// Vercel sits behind a trusted proxy; this lets express-rate-limit use the client IP.
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 4000);
let mongoConnection;
async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("Student database is not configured. Add MONGO_URI to the backend environment.");
  if (!mongoConnection) mongoConnection = mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  await mongoConnection;
}
const Student = mongoose.models.Student || mongoose.model("Student", new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  certificates: [{
    certificateId: { type: String, required: true },
    certificateNumber: String,
    universityName: String,
    verificationUrl: String,
    documentUrl: String,
    issuedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true }));
function createStudentToken(student) {
  if (!process.env.JWT_SECRET) throw new Error("Student authentication is not configured. Add JWT_SECRET to the backend environment.");
  return jwt.sign({ sub: String(student._id), email: student.email, role: "student" }, process.env.JWT_SECRET, { expiresIn: "7d" });
}
async function requireStudent(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !process.env.JWT_SECRET) return res.status(401).json({ error: "Please sign in to continue." });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "student") return res.status(401).json({ error: "Invalid student session." });
    await connectMongo();
    const student = await Student.findById(payload.sub);
    if (!student) return res.status(401).json({ error: "Student account not found. Please sign in again." });
    req.student = student;
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173,https://certichain-lovat.vercel.app").split(",").map((value) => value.trim());

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin(origin, callback) {
  const isCertiChainVercelOrigin = typeof origin === "string" &&
    /^https:\/\/certichain(?:-[a-z0-9]+)?-ali-4be7\.vercel\.app$/i.test(origin);
  if (!origin || allowedOrigins.includes(origin) || isCertiChainVercelOrigin) return callback(null, true);
  return callback(new Error("Origin is not allowed by CORS."));
} }));
app.use(express.json({ limit: "1mb" }));

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again later." }
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    callback(allowed.includes(file.mimetype) ? null : new Error("Only PDF, PNG and JPG files are supported."), allowed.includes(file.mimetype));
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "certichain-api", ipfsConfigured: Boolean(process.env.PINATA_JWT) });
});

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many email requests. Please try again later." }
});


app.post("/api/email/certificate-issued", emailLimiter, async (req, res) => {
  const { email, universityName, certificateNumber, certificateId, verificationUrl, documentUrl, transactionHash } = req.body || {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: "A valid student email address is required." });
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) return res.status(503).json({ error: "Email service is not configured. Add Gmail SMTP environment variables." });
  if (typeof certificateId !== "string" || !/^0x[0-9a-f]{64}$/i.test(certificateId) ||
      typeof verificationUrl !== "string" || !verificationUrl.startsWith("https://") ||
      typeof universityName !== "string" || typeof certificateNumber !== "string") {
    return res.status(400).json({ error: "Certificate email details are incomplete or invalid." });
  }

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  let student;
  let temporaryPassword = null;
  try {
    await connectMongo();
    student = await Student.findOne({ email: normalizedEmail });
    const isNewStudent = !student;
    // Existing students keep their current password. Only new accounts receive a temporary password.
    if (!student) {
      temporaryPassword = crypto.randomBytes(12).toString("base64url");
      student = new Student({ email: normalizedEmail, passwordHash: await bcrypt.hash(temporaryPassword, 12), certificates: [] });
    }
    if (!student.certificates.some(item => item.certificateId.toLowerCase() === certificateId.toLowerCase())) {
      student.certificates.push({
        certificateId,
        certificateNumber,
        universityName,
        verificationUrl,
        documentUrl: typeof documentUrl === "string" && documentUrl.startsWith("https://") ? documentUrl : ""
      });
    }
    await student.save();
    student._isNewStudent = isNewStudent;
  } catch (error) {
    console.error("Student account persistence failed:", error.message);
    return res.status(503).json({ error: (error.message.includes("MONGO_URI") || error.message.includes("MONGODB_URI")) ? error.message : "Student account service is temporarily unavailable." });
  }

  const safeUniversity = escapeHtml(universityName);
  const safeNumber = escapeHtml(certificateNumber);
  const safeId = escapeHtml(certificateId);
  const safeVerifyUrl = escapeHtml(verificationUrl);
  const safeDocumentUrl = typeof documentUrl === "string" && documentUrl.startsWith("https://") ? escapeHtml(documentUrl) : "";
  const safeTx = typeof transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(transactionHash) ? escapeHtml(transactionHash) : "";
  const passwordHtml = temporaryPassword
    ? `<div style="margin:22px 0;padding:18px;background:#f1f5ff;border:1px solid #dbe4ff;border-radius:10px"><strong>Student portal login</strong><p style="margin:10px 0 4px">Email: ${escapeHtml(normalizedEmail)}</p><p style="margin:4px 0">Temporary password: <strong style="font-family:monospace">${escapeHtml(temporaryPassword)}</strong></p><p style="font-size:12px;color:#536078">Keep this password private. You can use it to access all certificates linked to this email.</p></div>`
    : `<p>Your student portal account already exists. Sign in using your existing password and this email address.</p>`;
  const passwordText = temporaryPassword
    ? `Student portal email: ${normalizedEmail}\\nTemporary password: ${temporaryPassword}\\nKeep this password private.`
    : "Your student portal account already exists. Use your existing password to sign in.";
  try {
    const info = await sendEmail({
      to: normalizedEmail,
      subject: `Your certificate from ${universityName}`,
      text: ["Your academic certificate has been issued successfully.", `Institution: ${universityName}`, `Certificate number: ${certificateNumber}`, `Certificate ID: ${certificateId}`, `Verify certificate: ${verificationUrl}`, passwordText, safeDocumentUrl ? `Download certificate: ${documentUrl}` : "", safeTx ? `Blockchain transaction: https://sepolia.etherscan.io/tx/${transactionHash}` : ""].filter(Boolean).join("\n\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Your certificate is ready</h2><p>Your academic certificate has been issued successfully and recorded on the blockchain.</p><p><strong>Institution:</strong> ${safeUniversity}<br/><strong>Certificate number:</strong> ${safeNumber}</p><p style="word-break:break-all"><strong>Certificate ID:</strong> ${safeId}</p><p><a href="${safeVerifyUrl}">Verify certificate</a></p>${passwordHtml}${safeDocumentUrl ? `<p><a href="${safeDocumentUrl}">Download original certificate</a></p>` : ""}${safeTx ? `<p><a href="https://sepolia.etherscan.io/tx/${safeTx}">View blockchain transaction</a></p>` : ""}</div>`
    });
    return res.status(200).json({ sent: true, id: info.messageId, studentAccountCreated: Boolean(temporaryPassword) });
  } catch (error) {
    if (temporaryPassword && student) await Student.deleteOne({ _id: student._id }).catch(() => {});
    console.error("Certificate email request failed:", error.message);
    return res.status(502).json({ error: "Could not connect to the email provider." });
  }
});

const studentAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false });
app.post("/api/student/resend-password", studentAuthLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  try {
    await connectMongo();
    const student = await Student.findOne({ email });
    if (!student) return res.json({ sent: true, message: "If an account exists, a new password has been emailed." });
    const temporaryPassword = crypto.randomBytes(16).toString("base64url");
    await sendEmail({ to: email, subject: "Your CertiChain student portal password", text: `A password reset was requested. Your new temporary password is: ${temporaryPassword}. If you did not request this, contact your university.`, html: `<div style="font-family:Arial,sans-serif"><h2>Student portal password reset</h2><p>Your new temporary password:</p><p style="font-family:monospace;font-size:20px"><strong>${temporaryPassword}</strong></p><p>If you did not request this, contact your university.</p></div>` });
    student.passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await student.save();
    return res.json({ sent: true, message: "If an account exists, a new password has been emailed." });
  } catch (error) { console.error("Student password resend failed:", error.message); return res.status(502).json({ error: "Could not send a password email. Please try again later." }); }
});
app.post("/api/student/login", studentAuthLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  try {
    await connectMongo();
    const student = await Student.findOne({ email });
    if (!student || !(await bcrypt.compare(password, student.passwordHash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    return res.json({ token: createStudentToken(student), email: student.email });
  } catch (error) {
    console.error("Student login failed:", error.message);
    return res.status(503).json({ error: "Student login is temporarily unavailable. Please try again." });
  }
});
app.get("/api/student/certificates", requireStudent, async (req, res) => {
  res.json({ email: req.student.email, certificates: req.student.certificates });
});

app.post("/api/ipfs/upload", uploadLimiter, upload.single("file"), async (req, res) => {
  if (!process.env.PINATA_JWT) return res.status(503).json({ error: "IPFS is not configured. Add PINATA_JWT to backend/.env." });
  if (!req.file) return res.status(400).json({ error: "Choose a PDF, PNG or JPG file." });

  try {
    // Pinata's scoped API keys use the V3 Files upload endpoint.
    const form = new FormData();
    form.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append("network", "public");
    form.append("name", `CertiChain-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`);

    const response = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
      body: form
    });

    const responseText = await response.text();
    let payload = {};
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { message: responseText };
    }

    if (!response.ok) {
      // On auth failures, separately test whether the JWT itself is accepted.
      // Never log or return the JWT.
      let authTestStatus = null;
      if (response.status === 401) {
        try {
          const authTest = await fetch("https://api.pinata.cloud/data/testAuthentication", {
            headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }
          });
          authTestStatus = authTest.status;
        } catch {
          authTestStatus = "network-error";
        }
      }
      console.error("Pinata V3 upload failed:", {
        status: response.status,
        authTestStatus,
        response: payload
      });
      const errorMessage = response.status === 401 && authTestStatus === 401
        ? "Pinata rejected the configured JWT. Replace PINATA_JWT with a currently active JWT from Pinata."
        : response.status === 401 && authTestStatus === 200
          ? "Pinata accepts this JWT, but it is not authorized for V3 file uploads. Check the API key's Files write permission."
          : payload.error || payload.message || payload.detail || "Pinata upload failed.";
      return res.status(502).json({ error: errorMessage, providerStatus: response.status });
    }

    const fileData = payload.data || payload;
    const cid = fileData.cid;
    if (!cid) {
      console.error("Pinata V3 upload returned no CID:", payload);
      return res.status(502).json({ error: "Pinata upload response did not include a file CID." });
    }

    return res.status(201).json({
      cid,
      url: `https://gateway.pinata.cloud/ipfs/${cid}`,
      size: fileData.size ?? req.file.size
    });
  } catch (error) {
    console.error("IPFS upload request failed:", error);
    return res.status(500).json({ error: "IPFS upload failed. Check the backend terminal for details." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Maximum file size is 10 MB." : error.message });
  }
  console.error("API request error:", error);
  res.status(400).json({ error: error.message || "Invalid request." });
});

app.use((req, res) => res.status(404).json({ error: "Route not found", path: req.path }));

if (!process.env.VERCEL) app.listen(port, () => console.log(`CertiChain API listening on http://localhost:${port}`));

export default app;
