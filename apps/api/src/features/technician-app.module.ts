import { Module } from "@nestjs/common";
import { JobFieldController } from "../jobs/job-field.controller";
import { JobsModule } from "../jobs/jobs.module";

/** `technicianApp` feature: on-site endpoints. The logic lives in core (JobFieldService). */
@Module({ imports: [JobsModule], controllers: [JobFieldController] })
export class TechnicianAppModule {}
