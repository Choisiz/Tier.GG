require("dotenv").config();

module.exports = {
  development: {
    username: "postgres",
    password: "understand",
    database: "lol_analyzer",
    host: "localhost", // postgres → localhost 변경
    port: 5433, // docker에서 5433 포트로 매핑했으니까
    dialect: "postgres",
  },
};
