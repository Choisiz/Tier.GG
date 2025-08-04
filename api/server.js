const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "서버 정상작동중입니다." });
});

const PORT = process.env.PORT || 4000;

/* 서버 실행 */
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
