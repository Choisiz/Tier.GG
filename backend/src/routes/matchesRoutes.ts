import { Router } from "express";
import { matches } from "../controllers/matchesControllers";

const router = Router();

router.get("/", matches);

export default router;
