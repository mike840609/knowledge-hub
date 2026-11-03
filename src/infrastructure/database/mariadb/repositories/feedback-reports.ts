import type { Pool } from "mariadb";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackCategory, type FeedbackStatus } from "@/modules/personal/domain/feedback-report";
import type {
  FeedbackIssueRecord,
  FeedbackIssueStoreFilter,
  FeedbackReportStore,
  NewFeedbackReport,
} from "@/modules/personal/ports/feedback-report-store";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { DbRow } from "./shared";
import { asDate, asRequiredString } from "./shared";

function asCategory(value: unknown): FeedbackCategory {
  if (typeof value === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(value)) return value as FeedbackCategory;
  throw new IntegrityViolationError("Database returned an invalid feedback category.");
}

function asStatus(value: unknown): FeedbackStatus {
  if (typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value)) return value as FeedbackStatus;
  throw new IntegrityViolationError("Database returned an invalid feedback status.");
}

function mapIssue(row: DbRow): FeedbackIssueRecord {
  return {
    id: asRequiredString(row.id, "feedback report id"),
    userId: asRequiredString(row.user_id, "feedback report user_id"),
    empId: asRequiredString(row.emp_id, "feedback report emp_id"),
    userName: asRequiredString(row.user_name, "feedback report user_name"),
    category: asCategory(row.category),
    description: asRequiredString(row.description, "feedback report description"),
    pagePath: asRequiredString(row.page_path, "feedback report page_path"),
    status: asStatus(row.status),
    createdAt: asDate(row.created_at),
  };
}

export class MariaDbFeedbackReportStore implements FeedbackReportStore {
  constructor(private readonly pool: Pool) {}
  async appendWithinLimit(report: NewFeedbackReport, since: Date, limit: number) {
    // A plain read, not a locking one: the limit only has to stop a runaway loop, and an
    // INSERT … SELECT over the same rows would take gap locks two concurrent sends could deadlock on.
    const [{ n }] = await this.pool.query("SELECT COUNT(*) AS n FROM feedback_reports WHERE user_id=? AND created_at>?", [report.userId, since]);
    if (Number(n) >= limit) return null;
    const id = uuidv7();
    await this.pool.query(
      "INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, report.userId, report.empId, report.userName, report.category, report.description, report.pagePath, report.createdAt],
    );
    return id;
  }
  async listPage(filter: FeedbackIssueStoreFilter, limit: number): Promise<FeedbackIssueRecord[]> {
    const where: string[] = [], params: unknown[] = [];
    if (filter.status) { where.push("status = ?"); params.push(filter.status); }
    if (filter.category) { where.push("category = ?"); params.push(filter.category); }
    if (filter.userId) { where.push("user_id = ?"); params.push(filter.userId); }
    if (filter.before) { where.push("(created_at, id) < (?, ?)"); params.push(filter.before.createdAt, filter.before.id); }
    const rows = await this.pool.query<DbRow[]>(
      `SELECT id, user_id, emp_id, user_name, category, description, page_path, status, created_at
         FROM feedback_reports${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, limit]);
    return rows.map(mapIssue);
  }
}
