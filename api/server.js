const express = require("express");
const cors = require("cors");
const { Player } = require("./models");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// 기본 라우트
app.get("/", (req, res) => {
  res.json({ message: "LOL API 서버 + Sequelize 작동중! 🚀" });
});

// 모든 플레이어 조회
app.get("/api/players", async (req, res) => {
  try {
    const players = await Player.findAll();
    res.json({ count: players.length, data: players });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 플레이어 생성
app.post("/api/players", async (req, res) => {
  try {
    const player = await Player.create(req.body);
    res.status(201).json(player);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 API 서버 ${PORT}번 포트에서 실행중`);
});
