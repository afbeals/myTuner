// One identity for all programming fields; late preview/publication results cannot validate another draft.
export class ProgrammingDraft<T> {
  private revision = 0;
  private previewRevision: number | null = null;
  private publishedRevision: number | null = null;
  private baseline: string;
  private current: string;
  constructor(config: T) {
    this.baseline = this.current = JSON.stringify(config);
  }
  change(config: T) {
    const next = JSON.stringify(config);
    if (next !== this.current) {
      this.current = next;
      this.revision++;
      this.previewRevision = null;
    }
  }
  capture() {
    return this.revision;
  }
  previewed(revision: number) {
    if (revision === this.revision) this.previewRevision = revision;
  }
  published(revision: number) {
    if (revision === this.revision) {
      this.publishedRevision = revision;
      this.baseline = this.current;
    }
  }
  get dirty() {
    return this.baseline !== this.current;
  }
  get canPublish() {
    return this.previewRevision === this.revision;
  }
  get state() {
    return this.publishedRevision === this.revision
      ? "published"
      : this.canPublish
        ? "preview-current"
        : this.dirty
          ? "unsaved-draft"
          : "unchanged";
  }
}
