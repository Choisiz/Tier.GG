import { Router } from "express";
import { player } from "../controllers/tierControllers";

const router = Router();

router.get("/", player);

export default router;
