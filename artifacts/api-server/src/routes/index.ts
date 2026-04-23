import { Router, type IRouter } from "express";
import healthRouter from "./health";
import socialRouter from "./social";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(socialRouter);

export default router;
