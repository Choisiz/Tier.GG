import { Router } from "express";
import { puuid } from "../controllers/tierControllers";

const router = Router();

router.get("/puuid", puuid);

export default router;
