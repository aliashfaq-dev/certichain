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
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error("Origin is not allowed by CORS.")); } }));
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
