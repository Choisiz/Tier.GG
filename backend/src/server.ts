import "dotenv/config";
import express from "express";
import tierRoutes from "./routes/tierRoutes";
import matchesRoutes from "./routes/matchesRoutes";

const app = express();
const port = Number(process.env.PORT || 5500);

app.use(express.json());
//app.use(cors());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/", (_req, res) => {
  res.json({
    status: "running",
  });
});

app.use("/info/tier", tierRoutes);
app.use("/info/matches", matchesRoutes);

app.listen(port, () => {
  console.log(`[backend] listening on http://0.0.0.0:${port}`);
});
