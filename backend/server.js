const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(express.json());
app.use(cors());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/", (_req, res) => {
  res.json({
    name: "tier.gg backend",
    runtime: "node-express",
    status: "running",
  });
});

app.listen(port, () => {
  console.log(`[backend] listening on http://0.0.0.0:${port}`);
});
