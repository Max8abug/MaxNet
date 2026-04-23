import { Router, type IRouter } from "express";
import healthRouter from "./health";
import socialRouter from "./social";
import authRouter from "./auth";
import forumRouter from "./forum";
import youtubeRouter from "./youtube";
import blackjackRouter from "./blackjack";
import flappyRouter from "./flappy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(socialRouter);
router.use(forumRouter);
router.use(youtubeRouter);
router.use(blackjackRouter);
router.use(flappyRouter);

export default router;
