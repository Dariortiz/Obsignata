import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "backend" });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`RPC URL: ${process.env.RPC_URL}`);
});
