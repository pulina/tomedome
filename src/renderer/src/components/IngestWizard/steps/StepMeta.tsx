import styles from '../IngestWizard.module.css';

interface Props {
  title: string;
  setTitle: (v: string) => void;
  author: string;
  setAuthor: (v: string) => void;
  year: string;
  setYear: (v: string) => void;
  genre: string;
  setGenre: (v: string) => void;
  language: string;
  setLanguage: (v: string) => void;
}

export function StepMeta({
  title,
  setTitle,
  author,
  setAuthor,
  year,
  setYear,
  genre,
  setGenre,
  language,
  setLanguage,
}: Props) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Title<span className={styles.required}>*</span></label>
        <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Name of the Wind" autoFocus />
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Author</label>
        <input className={styles.input} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Patrick Rothfuss" />
      </div>
      <div className={styles.inputRow}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Year</label>
          <input className={styles.input} type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2007" min={0} max={2100} />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Genre</label>
          <input className={styles.input} value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="e.g. Fantasy" />
        </div>
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Language</label>
        <input className={styles.input} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English, Polish, German…" />
        <div className={styles.fieldHint}>Abstracts will be generated in this language.</div>
      </div>
    </>
  );
}
