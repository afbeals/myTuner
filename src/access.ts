// Recheck capabilities on existing streams as well as at request entry.
export class AccessRegistry {
  private entries = new Set<{ check: () => boolean; close: () => void }>();
  track(check: () => boolean, close: () => void): () => void {
    const entry = { check, close };
    this.entries.add(entry);
    return () => this.entries.delete(entry);
  }
  recheck(): void {
    for (const entry of [...this.entries]) {
      let valid = false;
      try {
        valid = entry.check();
      } catch {}
      if (!valid) {
        this.entries.delete(entry);
        entry.close();
      }
    }
  }
  close(): void {
    for (const entry of this.entries) entry.close();
    this.entries.clear();
  }
}
