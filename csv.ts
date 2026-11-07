import { safeCell } from "../../worker/routes/export";
export const csvSafe = (v: string) => safeCell(v);
