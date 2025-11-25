import { Router } from "express";
import { champion } from "../controllers/championControllers";
import { championTierList } from "../controllers/championControllers";

const router = Router();

router.get("/", champion);

router.get("/tierList", championTierList);

export default router;
