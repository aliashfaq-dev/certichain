import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { rateLimit } from "express-rate-limit";

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173,https://certichain-lovat.vercel.app").split(",").map((value) => value.trim());

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin(origin, callback) {
  const isCertiChainVercelOrigin = typeof origin === "string" &&
    /^https:\\/\\/certichain(?:-[a-z0-9]+)?-ali-4be7\\.vercel\\.app$/i.test(origin);
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
  const validEmail = typeof email === "string" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim());
  if (!validEmail) return res.status(400).json({ error: "A valid student email address is required." });
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return res.status(503).json({ error: "Email service is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to the backend Vercel project." });
  }
  if (typeof certificateId !== "string" || !/^0x[0-9a-f]{64}$/i.test(certificateId) ||
      typeof verificationUrl !== "string" || !verificationUrl.startsWith("https://") ||
      typeof universityName !== "string" || typeof certificateNumber !== "string") {
    return res.status(400).json({ error: "Certificate email details are incomplete or invalid." });
  }

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const safeUniversity = escapeHtml(universityName);
  const safeNumber = escapeHtml(certificateNumber);
  const safeId = escapeHtml(certificateId);
  const safeVerifyUrl = escapeHtml(verificationUrl);
  const safeDocumentUrl = typeof documentUrl === "string" && documentUrl.startsWith("https://") ? escapeHtml(documentUrl) : "";
  const safeTx = typeof transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(transactionHash) ? escapeHtml(transactionHash) : "";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [email.trim().toLowerCase()],
        subject: `Your certificate from ${universityName}`,
        text: [
          "Your certificate has been issued successfully.",
          `Institution: ${universityName}`,
          `Certificate number: ${certificateNumber}`,
          `Certificate ID: ${certificateId}`,
          `Verify certificate: ${verificationUrl}`,
          safeDocumentUrl ? `Download certificate: ${documentUrl}` : "",
          safeTx ? `Blockchain transaction: https://sepolia.etherscan.io/tx/${transactionHash}` : ""
        ].filter(Boolean).join("\\n\\n"),
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Your certificate is ready</h2><p>Your academic certificate has been issued successfully and recorded on the blockchain.</p><p><strong>Institution:</strong> ${safeUniversity}<br/><strong>Certificate number:</strong> ${safeNumber}</p><p style="word-break:break-all"><strong>Certificate ID:</strong> ${safeId}</p><p><a href="${safeVerifyUrl}" style="display:inline-block;padding:12px 18px;background:#2457d6;color:#fff;text-decoration:none;border-radius:8px">Verify certificate</a></p>${safeDocumentUrl ? `<p><a href="${safeDocumentUrl}">Download original certificate</a></p>` : ""}${safeTx ? `<p><a href="https://sepolia.etherscan.io/tx/${safeTx}">View blockchain transaction</a></p>` : ""}<p style="color:#687386;font-size:12px">Keep this email as your certificate notification. Anyone with the verification link can independently check its status.</p></div>`
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Resend email failed:", { status: response.status, message: payload.message || payload.name });
      return res.status(502).json({ error: payload.message || "Email provider rejected the message." });
    }
    return res.status(200).json({ sent: true, id: payload.id });
  } catch (error) {
    console.error("Certificate email request failed:", error);
    return res.status(502).json({ error: "Could not connect to the email provider." });
  }
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
      // Log the provider response for local debugging, but never log the JWT.
      console.error("Pinata V3 upload failed:", {
        status: response.status,
        statusText: response.statusText,
        response: payload
      });
      return res.status(502).json({
        error: payload.error || payload.message || payload.detail || "Pinata upload failed.",
        providerStatus: response.status
      });
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
