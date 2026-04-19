import type { BookStats } from '@shared/types';
import { AVAILABLE_JOBS } from '../constants';
import styles from '../IngestWizard.module.css';

interface Props {
  selectedJobs: Set<string>;
  onToggle: (type: string) => void;
  stats: BookStats | null;
  excludedCount: number;
  error: string | null;
}

export function StepProcessing({
  selectedJobs,
  onToggle,
  stats,
  excludedCount,
  error,
}: Props) {
  return (
    <>
      <div className={styles.jobList}>
        {AVAILABLE_JOBS.map((job) => (
          <label key={job.type} className={`${styles.jobItem} ${job.disabled ? styles.jobItemDisabled : ''}`}>
            <input
              type="checkbox"
              className={styles.jobCheckbox}
              checked={selectedJobs.has(job.type)}
              onChange={() => !job.disabled && onToggle(job.type)}
              disabled={job.disabled}
            />
            <div>
              <div className={styles.jobName}>{job.name}</div>
              <div className={styles.jobDesc}>{job.desc}</div>
            </div>
            {job.disabled && <span className={styles.jobBadge}>coming soon</span>}
            {!job.disabled && job.type === 'abstract_generation' && stats && (
              <span className={styles.jobBadge}>~{stats.estimatedAbstractCalls} calls</span>
            )}
          </label>
        ))}
      </div>
      {excludedCount > 0 && (
        <div className={styles.fieldHint} style={{ marginTop: 10 }}>
          {excludedCount} chunk{excludedCount !== 1 ? 's' : ''} excluded from processing.
        </div>
      )}
      {error && <div className={styles.errorText}>{error}</div>}
    </>
  );
}
