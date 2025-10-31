import { Router } from "express";
import { gameInfo } from "../controllers/gameInfoControlles";

const router = Router();

router.get("/gameInfo", gameInfo);

export default router;
