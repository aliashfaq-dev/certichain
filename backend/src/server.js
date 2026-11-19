import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "certichain-api" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found", path: req.path });
});

app.listen(port, () => {
  console.log(`CertiChain API listening on http://localhost:${port}`);
});
