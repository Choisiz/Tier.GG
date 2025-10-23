import { Router } from "express";
import { matches10 } from "../controllers/matchesControllers";

const router = Router();

router.get("/matches10", matches10);

export default router;
