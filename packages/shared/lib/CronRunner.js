import { Cron } from "croner";

class CronRunner {
  constructor(mode = "sequential") {
    this.mode = mode;
    this.jobs = [];
    this.running = false;
    this.schedulers = [];
  }

  register(interval, callback, name = "") {
    this.jobs.push({
      interval,
      callback: this.wrapCallback(callback, name),
      name,
    });
  }

  wrapCallback(callback, name) {
    return async () => {
      try {
        console.log(`▶️ Starting: ${name}`);
        await callback();
        console.log(`✅ Finished: ${name}`);
      } catch (err) {
        console.error(`❌ Error in ${name}:`, err);
      }
    };
  }

  async runner() {
    if (this.running) {
      console.warn(
        "⏳ Previous sequential job still running. Skipping this run."
      );
      return;
    }

    this.running = true;
    console.log(
      "🔁 Sequential run triggered at",
      new Date().toLocaleTimeString()
    );

    for (const job of this.jobs) {
      await job.callback();
    }

    console.log("🏁 Sequential run completed");
    this.running = false;
  }

  start() {
    if (this.mode === "sequential") {
      console.log("⏱ Running in sequential mode");
      this.schedulers.push(new Cron("*/10 * * * *", this.runner.bind(this)));
    } else {
      console.log("⏱ Running in concurrent mode");
      this.jobs.forEach((job) => {
        this.schedulers.push(new Cron(job.interval, this.wrapConcurrent(job)));
      });
    }
  }

  stop() {
    this.schedulers.forEach((scheduler) => scheduler.stop());
    this.schedulers = [];
    this.running = false;
    console.log("🛑 All scheduled jobs stopped");
  }

  wrapConcurrent(job) {
    let running = false;
    let tickSkipped = false;

    const wrapper = async () => {
      if (running) {
        tickSkipped = true;
        console.warn(`⏳ Skipping overlapping job: ${job.name}`);
        return;
      }

      running = true;
      tickSkipped = false;

      try {
        await job.callback();
      } finally {
        running = false;

        /* If a cron tick was skipped while this job was running, re-trigger
         * immediately so we don't wait an extra interval cycle. */
        if (tickSkipped) {
          tickSkipped = false;
          console.log(`🔄 Re-triggering ${job.name} (skipped tick detected)`);
          // Go through the wrapper so the overlap guard still applies
          Promise.resolve().then(wrapper);
        }
      }
    };

    return wrapper;
  }
}

export default CronRunner;
