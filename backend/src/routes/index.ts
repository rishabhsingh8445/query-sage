import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import historyRouter from "./history";
import shareRouter from "./share";
import { chatRouter } from "./chat";
import { schemaRouter } from "./schema";
import { intelligenceRouter } from "./intelligence";
import { indexesRouter } from "./indexes";
import { monitorRouter } from "./monitor";
import { errorsRouter } from "./errors";
import { estimateRouter } from "./estimate";
import { migrateRouter } from "./migrate";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(historyRouter);
router.use("/share", shareRouter);
router.use(chatRouter);
router.use(schemaRouter);
router.use(intelligenceRouter);
router.use(indexesRouter);
router.use(monitorRouter);
router.use(errorsRouter);
router.use(estimateRouter);
router.use(migrateRouter);

export default router;
