import "dotenv/config";
import express from "express";
import playerRoutes from "./routes/playerRoutes";
import matchesRoutes from "./routes/matchesRoutes";
import gameInfoRoutes from "./routes/gameInfoRoutes";
import championRoutes from "./routes/championRoutes";
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

app.use("/info/player", playerRoutes);
app.use("/info/matches", matchesRoutes);
app.use("/info/gameInfo", gameInfoRoutes);
app.use("/info/champion", championRoutes);

app.listen(port, () => {
  console.log(`[backend] listening on http://0.0.0.0:${port}`);
});
