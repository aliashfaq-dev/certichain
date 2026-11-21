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
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

const app = express();
async function sendEmail({ to, subject, text, html, attachments = [] }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.");
  const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true", auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return transporter.sendMail({ from: SMTP_FROM, to, subject, text, html, attachments });
}

async function buildCertificatePdf({ documentUrl, documentMimeType, verificationUrl, certificateNumber, universityName }) {
  let pdf;
  if (typeof documentUrl === "string" && documentUrl.startsWith("https://gateway.pinata.cloud/ipfs/")) {
    const response = await fetch(documentUrl);
    if (!response.ok) throw new Error("Could not retrieve the original certificate file for the email PDF.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = (documentMimeType || response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/pdf") || documentUrl.toLowerCase().endsWith(".pdf")) {
      pdf = await PDFDocument.load(bytes);
    } else {
      pdf = await PDFDocument.create();
      const page = pdf.addPage([595.28, 841.89]);
      const image = contentType.includes("png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const scale = Math.min(515 / image.width, 700 / image.height);
      page.drawImage(image, { x: (595.28 - image.width * scale) / 2, y: (841.89 - image.height * scale) / 2 + 35, width: image.width * scale, height: image.height * scale });
    }
  } else {
    pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(String(universityName || "Academic Institution"), { x: 48, y: 760, size: 20, font, color: rgb(0.12,0.18,0.32) });
    page.drawText("Certificate record", { x: 48, y: 720, size: 14, font });
    page.drawText("Certificate number: " + String(certificateNumber || "—"), { x: 48, y: 690, size: 11, font });
  }
  if (!pdf.getPageCount()) pdf.addPage([595.28, 841.89]);
  const qrBytes = await QRCode.toBuffer(verificationUrl, { type: "png", width: 220, margin: 1 });
  const qrImage = await pdf.embedPng(qrBytes);
  const firstPage = pdf.getPages()[0];
  const qrSize = 76;
  firstPage.drawRectangle({ x: firstPage.getWidth()-qrSize-20, y: 18, width: qrSize+12, height: qrSize+24, color: rgb(1,1,1), borderColor: rgb(0.86,0.88,0.92), borderWidth: 0.7 });
  firstPage.drawImage(qrImage, { x: firstPage.getWidth()-qrSize-14, y: 36, width: qrSize, height: qrSize });
  return Buffer.from(await pdf.save());
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

const UniversityCertificate = mongoose.models.UniversityCertificate || mongoose.model("UniversityCertificate", new mongoose.Schema({
  universityWallet: { type: String, required: true, lowercase: true, index: true },
  certificateId: { type: String, required: true, unique: true, lowercase: true },
  certificateNumber: { type: String, required: true },
  universityName: { type: String, required: true },
  studentEmail: { type: String, required: true, lowercase: true },
  recipientWallet: { type: String, default: "" },
  documentUrl: { type: String, default: "" },
  verificationUrl: { type: String, default: "" },
  transactionHash: { type: String, default: "" },
  issuedAt: { type: Date, default: Date.now }
}, { timestamps: true }));


const UniversitySequence = mongoose.models.UniversitySequence || mongoose.model("UniversitySequence", new mongoose.Schema({
  universityWallet: { type: String, required: true, unique: true, lowercase: true },
  lastValue: { type: Number, required: true, default: 0 }
}, { timestamps: true }));


const UniversityAccount = mongoose.models.UniversityAccount || mongoose.model("UniversityAccount", new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  universityName: { type: String, required: true, trim: true },
  universityCode: { type: String, required: true, uppercase: true, trim: true },
  wallet: { type: String, required: true, unique: true, lowercase: true },
  verified: { type: Boolean, default: false },
  emailVerificationHash: { type: String, default: "" },
  emailVerificationExpires: { type: Date, default: null },
  certificateTemplates: [{ name: String, cid: String, url: String, mimeType: String, fieldMap: mongoose.Schema.Types.Mixed, active: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true }));
const UniversityNonce = mongoose.models.UniversityNonce || mongoose.model("UniversityNonce", new mongoose.Schema({
  wallet: { type: String, required: true, unique: true, lowercase: true },
  nonce: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 }
}));
function createUniversityToken(account) {
  if (!process.env.JWT_SECRET) throw new Error("University authentication is not configured.");
  return jwt.sign({ sub: String(account._id), email: account.email, role: "university", wallet: account.wallet }, process.env.JWT_SECRET, { expiresIn: "12h" });
}
async function isAuthorizedUniversityWallet(wallet){
 const rpc=process.env.RPC_URL||process.env.SEPOLIA_RPC_URL||"https://ethereum-sepolia-rpc.publicnode.com";
 const address=process.env.CONTRACT_ADDRESS||"0x396F092208aDC112B02f237bEe969f01c07c9DFB";
 const {JsonRpcProvider,Contract}=await import("ethers");
 const provider=new JsonRpcProvider(rpc);
 const contract=new Contract(address,["function getUniversity(address wallet) view returns (tuple(bytes32 universityId,string name,bool active))"],provider);
 const university=await contract.getUniversity(wallet);
 return Boolean(university.active);
}
async function requireUniversity(req,res,next) {
  try {
    const token=(req.headers.authorization||"").replace(/^Bearer /,"");
    if(!token || !process.env.JWT_SECRET) return res.status(401).json({error:"Sign in to your university account."});
    const payload=jwt.verify(token,process.env.JWT_SECRET);
    if(payload.role!=="university") return res.status(403).json({error:"University account required."});
    await connectMongo();
    const account=await UniversityAccount.findById(payload.sub);
    if(!account || !account.verified) return res.status(401).json({error:"University account is unavailable or unverified."});
    req.university=account; next();
  } catch { return res.status(401).json({error:"University session expired. Sign in again."}); }
}

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
  const { email, universityName, certificateNumber, certificateId, verificationUrl, documentUrl, documentMimeType, transactionHash, universityWallet, recipientWallet } = req.body || {};
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

  if (typeof universityWallet !== "string" || !/^0x[0-9a-f]{40}$/i.test(universityWallet)) return res.status(400).json({ error: "University wallet is missing or invalid." });
  try {
    await UniversityCertificate.updateOne({ certificateId: certificateId.toLowerCase() }, { $setOnInsert: { universityWallet, certificateId, certificateNumber, universityName, studentEmail: normalizedEmail, recipientWallet: typeof recipientWallet === "string" ? recipientWallet : "", documentUrl: typeof documentUrl === "string" ? documentUrl : "", verificationUrl, transactionHash: typeof transactionHash === "string" ? transactionHash : "", issuedAt: new Date() } }, { upsert: true });
  } catch (error) { console.error("University history save failed:", error.message); }
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
    ? `Student portal email: ${normalizedEmail}\nTemporary password: ${temporaryPassword}\nKeep this password private.`
    : "Your student portal account already exists. Use your existing password to sign in.";
  try {
    const pdfBytes = await buildCertificatePdf({ documentUrl, documentMimeType, verificationUrl, certificateNumber, universityName });
    const info = await sendEmail({
      to: normalizedEmail,
      subject: `Your certificate from ${universityName}`,
      text: ["Your academic certificate has been issued successfully.", `Institution: ${universityName}`, `Certificate number: ${certificateNumber}`, `Certificate ID: ${certificateId}`, `Verify certificate: ${verificationUrl}`, passwordText, safeDocumentUrl ? `Download certificate: ${documentUrl}` : "", safeTx ? `Blockchain transaction: https://sepolia.etherscan.io/tx/${transactionHash}` : ""].filter(Boolean).join("\n\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Your certificate is ready</h2><p>Your academic certificate has been issued successfully and recorded on the blockchain.</p><p><strong>Institution:</strong> ${safeUniversity}<br/><strong>Certificate number:</strong> ${safeNumber}</p><p style="word-break:break-all"><strong>Certificate ID:</strong> ${safeId}</p><p><a href="${safeVerifyUrl}">Verify certificate</a></p>${passwordHtml}<p>Your certificate PDF is attached. Scan its QR code to open the public verification page.</p></div>`,
      attachments: [{ filename: `CertiChain-${String(certificateNumber).replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`, content: pdfBytes, contentType: "application/pdf" }]
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


const sequenceLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
app.post("/api/university/next-number", sequenceLimiter, async (req, res) => {
  const wallet = typeof req.body?.wallet === "string" ? req.body.wallet.trim().toLowerCase() : "";
  const universityName = typeof req.body?.universityName === "string" ? req.body.universityName.trim() : "";
  const universityId = typeof req.body?.universityId === "string" ? req.body.universityId.trim() : "";
  if (!/^0x[a-f0-9]{40}$/.test(wallet) || !universityName || !universityId) return res.status(400).json({ error: "A valid university wallet, name and ID are required." });
  try {
    await connectMongo();
    const existing = await UniversityCertificate.find({ universityWallet: wallet }).select("certificateNumber").lean();
    const prefix = universityName.normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || universityId.replace(/^0x/i, "").slice(0, 4).toUpperCase();
    const legacyMax = existing.reduce((max, item) => { const match = String(item.certificateNumber || "").match(/-(\\d+)$/); return match ? Math.max(max, Number(match[1])) : max; }, 0);
    await UniversitySequence.updateOne({ universityWallet: wallet }, { $max: { lastValue: legacyMax }, $setOnInsert: { universityWallet: wallet } }, { upsert: true });
    const sequence = await UniversitySequence.findOneAndUpdate({ universityWallet: wallet }, { $inc: { lastValue: 1 } }, { new: true });
    return res.json({ certificateNumber: `${prefix}-${String(sequence.lastValue).padStart(5, "0")}`, sequence: sequence.lastValue });
  } catch (error) {
    console.error("Certificate sequence reservation failed:", error.message);
    return res.status(503).json({ error: "Could not reserve the next certificate number. Please retry." });
  }
});


const universityAuthLimiter = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
app.post("/api/admin/university-account", universityAuthLimiter, async(req,res)=>{
 const wallet=String(req.body?.wallet||"").toLowerCase(),email=String(req.body?.email||"").trim().toLowerCase(),password=String(req.body?.password||""),universityName=String(req.body?.universityName||"").trim(),universityCode=String(req.body?.universityCode||"").trim().toUpperCase(),signature=String(req.body?.signature||"");
 if(!/^0x[a-f0-9]{40}$/.test(wallet)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||!universityName||!/^[A-Z0-9-]{2,16}$/.test(universityCode)||!signature)return res.status(400).json({error:"Provide a valid university wallet, official email, name, code and password (10+ characters)."});
 try{
  await connectMongo();
  const rpc=process.env.RPC_URL||process.env.SEPOLIA_RPC_URL||"https://ethereum-sepolia-rpc.publicnode.com",address=process.env.CONTRACT_ADDRESS||"0x396F092208aDC112B02f237bEe969f01c07c9DFB";
  const {JsonRpcProvider,Contract,verifyMessage}=await import("ethers"),provider=new JsonRpcProvider(rpc),contract=new Contract(address,["function owner() view returns (address)","function getUniversity(address) view returns (tuple(bytes32 universityId,string name,bool active))"],provider),owner=await contract.owner();
  const message="CertiChain Owner Creates University Account\nWallet: "+wallet+"\nEmail: "+email+"\nUniversity: "+universityName+"\nCode: "+universityCode;
  if(verifyMessage(message,signature).toLowerCase()!==owner.toLowerCase())return res.status(403).json({error:"Only the platform owner wallet can create university accounts."});
  const uni=await contract.getUniversity(wallet);if(!uni.active||uni.name!==universityName)return res.status(403).json({error:"Authorize this wallet on-chain first and use the exact registered university name."});
  if(await UniversityAccount.findOne({$or:[{email},{wallet}]}))return res.status(409).json({error:"A university account already exists for this email or wallet."});
  const account=new UniversityAccount({email,passwordHash:await bcrypt.hash(password,12),universityName,universityCode,wallet,verified:true});await account.save();
  try{await sendEmail({to:email,subject:"Your CertiChain university account",text:"The platform owner created your university issuer account.\nUniversity: "+universityName+"\nLogin email: "+email+"\nInitial password: "+password+"\nAuthorized wallet: "+wallet+"\nSign in to CertiChain and change your password after your first login.",html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Your university issuer account is ready</h2><p>The CertiChain platform owner created your account.</p><p><b>University:</b> ${universityName}<br/><b>Login email:</b> ${email}<br/><b>Initial password:</b> <code>${password}</code><br/><b>Authorized wallet:</b> ${wallet}</p><p>Sign in and change your password after your first login.</p></div>`});}catch(error){await UniversityAccount.deleteOne({_id:account._id});throw error;}
  return res.status(201).json({created:true,email});
 }catch(error){console.error("Owner university account creation failed:",error.message);return res.status(503).json({error:error.message.includes("SMTP")?"Email service is not configured. Configure SMTP before creating university accounts.":"Could not create university account. Check wallet authorization, email and backend configuration."});}
});
app.post("/api/university/auth/login",universityAuthLimiter,async(req,res)=>{
 const email=String(req.body?.email||"").trim().toLowerCase(),password=String(req.body?.password||"");
 try {await connectMongo();const account=await UniversityAccount.findOne({email});if(!account||!(await bcrypt.compare(password,account.passwordHash)))return res.status(401).json({error:"Incorrect email or password."});if(!account.verified)return res.status(403).json({error:"Verify your university email before signing in."});return res.json({token:createUniversityToken(account),email:account.email,university:{name:account.universityName,code:account.universityCode,wallet:account.wallet}});}
 catch{return res.status(503).json({error:"University login is temporarily unavailable."});}
});
app.get("/api/university/account",requireUniversity,(req,res)=>res.json({email:req.university.email,university:{name:req.university.universityName,code:req.university.universityCode,wallet:req.university.wallet,templates:req.university.certificateTemplates}}));
app.patch("/api/university/account",requireUniversity,async(req,res)=>{
 const name=String(req.body?.universityName||"").trim(),code=String(req.body?.universityCode||"").trim().toUpperCase();
 if(!name||!/^[A-Z0-9-]{2,16}$/.test(code))return res.status(400).json({error:"Enter a valid university name and code."});
 try {const collision=await UniversityAccount.findOne({universityCode:code,_id:{$ne:req.university._id}});if(collision)return res.status(409).json({error:"That university code is already in use."});req.university.universityName=name;req.university.universityCode=code;await req.university.save();return res.json({updated:true,university:{name,code,wallet:req.university.wallet}});}
 catch{return res.status(503).json({error:"Could not update university profile."});}
});
app.post("/api/university/templates",requireUniversity,async(req,res)=>{
 const name=String(req.body?.name||"").trim(),cid=String(req.body?.cid||"").trim(),mimeType=String(req.body?.mimeType||"").trim();
 if(!name||!/^[a-zA-Z0-9]+$/.test(cid)||!["application/pdf","image/png","image/jpeg"].includes(mimeType))return res.status(400).json({error:"Provide a template name and a valid uploaded PDF, PNG or JPG CID."});
 try {const active=Boolean(req.body?.active);if(active)req.university.certificateTemplates.forEach(t=>t.active=false);req.university.certificateTemplates.push({name,cid,url:"https://gateway.pinata.cloud/ipfs/"+cid,mimeType,fieldMap:req.body?.fieldMap||{},active});await req.university.save();return res.status(201).json({templates:req.university.certificateTemplates});}
 catch{return res.status(503).json({error:"Could not save certificate template."});}
});
app.patch("/api/university/templates/:templateId/active",requireUniversity,async(req,res)=>{
 const target=req.university.certificateTemplates.id(req.params.templateId);if(!target)return res.status(404).json({error:"Template not found."});
 req.university.certificateTemplates.forEach(t=>t.active=String(t._id)===String(target._id));await req.university.save();return res.json({templates:req.university.certificateTemplates});
});
app.patch("/api/university/password",requireUniversity,async(req,res)=>{
 const current=String(req.body?.currentPassword||""),next=String(req.body?.newPassword||"");if(next.length<10)return res.status(400).json({error:"New password must be at least 10 characters."});
 if(!(await bcrypt.compare(current,req.university.passwordHash)))return res.status(401).json({error:"Current password is incorrect."});
 req.university.passwordHash=await bcrypt.hash(next,12);await req.university.save();return res.json({updated:true});
});

app.get("/api/university/history", async (req, res) => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim().toLowerCase() : "";
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: "A valid university wallet address is required." });
  try {
    await connectMongo();
    const certificates = await UniversityCertificate.find({ universityWallet: wallet })
      .select("certificateId certificateNumber universityName recipientWallet documentUrl verificationUrl transactionHash issuedAt")
      .sort({ issuedAt: -1 }).limit(500).lean();
    return res.json({ certificates });
  } catch (error) {
    console.error("University certificate history failed:", error.message);
    return res.status(503).json({ error: "Certificate history is temporarily unavailable." });
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
