import { Command, CommandRunner } from 'nest-commander';
import { JobService } from 'src/services/job.service';

interface JobStats {
  jobCounts?: {
    active?: number;
    completed?: number;
    failed?: number;
    delayed?: number;
    waiting?: number;
    paused?: number;
  };
}

@Command({
  name: 'queue-stats',
  description: 'Print BullMQ queue statistics (counts and status) as JSON',
})
export class QueueStatsCommand extends CommandRunner {
  constructor(private jobService: JobService) {
    super();
  }

  interface JobCounts {
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    waiting: number;
    paused: number;
  }

  interface QueueStats {
    jobCounts: JobCounts;
    // Add other properties if needed
  }

  private printJson(entries: Array<[string, QueueStats]>) {
    const queues: Record<string, QueueStats> = {};
    const totals: JobCounts = { active: 0, completed: 0, failed: 0, delayed: 0, waiting: 0, paused: 0 };
    for (const [name, stats] of entries) {
      queues[name] = stats;
      const counts = stats.jobCounts || {};
      totals.active += counts.active || 0;
      totals.completed += counts.completed || 0;
      totals.failed += counts.failed || 0;
      totals.delayed += counts.delayed || 0;
      totals.waiting += counts.waiting || 0;
      totals.paused += counts.paused || 0;
    }
    const output = { queues, totals: { jobCounts: totals } };
    console.log(JSON.stringify(output, null, 2));
  }
      const counts = stats.jobCounts || {};
      totals.active += counts.active || 0;
      totals.completed += counts.completed || 0;
      totals.failed += counts.failed || 0;
      totals.delayed += counts.delayed || 0;
      totals.waiting += counts.waiting || 0;
      totals.paused += counts.paused || 0;
    }
    const output = { queues, totals: { jobCounts: totals } };
    console.log(JSON.stringify(output, null, 2));
  }

}
