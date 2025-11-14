import { Router } from "express";
import { champion } from "../controllers/championControllers";

const router = Router();

router.get("/", champion);

export default router;
