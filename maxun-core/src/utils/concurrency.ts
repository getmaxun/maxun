/**
 * Concurrency class for running concurrent tasks while managing a limited amount of resources.
 */
export default class Concurrency {
  /**
  * Maximum number of workers running in parallel. If set to `null`, there is no limit.
  */
  maxConcurrency: number = 1;

  /**
  * Number of currently active workers.
  */
  activeWorkers: number = 0;

  /**
  * Queue of jobs waiting to be completed.
  */
  private jobQueue: Function[] = [];

  /**
  * "Resolve" callbacks of the waitForCompletion() promises.
  */
  private waiting: Function[] = [];

  /**
  * Constructs a new instance of concurrency manager.
  * @param {number} maxConcurrency Maximum number of workers running in parallel.
  */
  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
  * Takes a waiting job out of the queue and runs it.
  */
  private runNextJob(): void {
    const job = this.jobQueue.pop();

    if (job) {
      // console.debug("Running a job...");
      job().then(() => {
        // console.debug("Job finished, running the next waiting job...");
        this.runNextJob();
      });
    } else {
      // console.debug("No waiting job found!");
      this.activeWorkers -= 1;
      if (this.activeWorkers === 0) {
        // console.debug("This concurrency manager is idle!");
        this.waiting.forEach((x) => x());
      }
    }
  }

  /**
  * Pass a job (a time-demanding async function) to the concurrency manager. \
  * The time of the job's execution depends on the concurrency manager itself
  * (given a generous enough `maxConcurrency` value, it might be immediate,
  * but this is not guaranteed).
  * @param worker Async function to be executed (job to be processed).
  */
  addJob(job: () => Promise<any>): void {
    // console.debug("Adding a worker!");
    this.jobQueue.push(job);

    if (!this.maxConcurrency || this.activeWorkers < this.maxConcurrency) {
      this.runNextJob();
      this.activeWorkers += 1;
    } else {
      // console.debug("No capacity to run a worker now, waiting!");
    }
  }

  /**
  * Waits until there is no running nor waiting job. \
  * If the concurrency manager is idle at the time of calling this function,
  * it waits until at least one job is completed (can be "presubscribed").
  * @returns Promise, resolved after there is no running/waiting worker.
  */
  waitForCompletion(): Promise<void> {
    return new Promise((res) => {
      this.waiting.push(res);
    });
  }
}
