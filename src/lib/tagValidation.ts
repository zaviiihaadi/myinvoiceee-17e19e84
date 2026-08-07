import { toast } from 'sonner';

export interface TemplateTagReport {
  templateTags: string[];
  unknownTags: string[];
  emptyTags: string[];
  unusedFields: string[];
  valid: boolean;
}

const preview = (list: string[], max = 4) =>
  list.slice(0, max).join(', ') + (list.length > max ? ` +${list.length - max} more` : '');

/**
 * Surfaces {{tag}} -> extracted-field mapping problems returned by the
 * invoice generation function. Purely informational: generation still runs.
 */
export function reportTemplateTagIssues(
  report: TemplateTagReport | undefined | null,
  context?: string,
) {
  if (!report || report.valid) return;
  const label = context ? `${context}: ` : '';

  if (report.unknownTags?.length) {
    toast.warning(`${label}Unmapped template tags`, {
      description: `No extracted field matches: ${preview(report.unknownTags)}`,
    });
  }
  if (report.emptyTags?.length) {
    toast.warning(`${label}Missing data for template tags`, {
      description: `Left blank in the PDF: ${preview(report.emptyTags)}`,
    });
  }
  console.warn('Template tag report', context ?? '', report);
}
