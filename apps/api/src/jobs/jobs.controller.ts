import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { ApiKeyScope } from "../common/api-key-scope";
import {
  type BoardQuery,
  boardQuerySchema,
  type DispatchBoardDto,
  type ScheduleJobData,
  scheduleJobSchema,
  jobCreateSchema,
  type JobCreateData,
  type JobDto,
  type JobListQuery,
  jobListQuerySchema,
  type JobStatsDto,
  type JobTransitionInput,
  jobTransitionSchema,
  type JobUpdateData,
  jobUpdateSchema,
  type Paginated,
} from "@opsdesk/shared";
import type { RequestUser } from "../auth/auth.types";
import { ApiZodBody, ApiZodQuery, CurrentUser, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JobsService } from "./jobs.service";

@ApiTags("jobs")
@ApiCookieAuth()
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Owners/dispatchers see all jobs; technicians only their own (enforced in the service). */
  @Get()
  @ApiKeyScope("jobs:read")
  @ApiZodQuery(jobListQuerySchema)
  list(
    @Query(new ZodValidationPipe(jobListQuerySchema)) q: JobListQuery,
    @CurrentUser() actor: RequestUser,
  ): Promise<Paginated<JobDto>> {
    return this.jobs.list(q, actor);
  }

  @Get("stats")
  stats(@CurrentUser() actor: RequestUser): Promise<JobStatsDto> {
    return this.jobs.stats(actor);
  }

  /** Dispatch board data. Declared before `:id` so "board" isn't parsed as an id. */
  @Get("board")
  @Roles("OWNER", "DISPATCHER")
  @ApiZodQuery(boardQuerySchema)
  board(@Query(new ZodValidationPipe(boardQuerySchema)) q: BoardQuery): Promise<DispatchBoardDto> {
    return this.jobs.board(q);
  }

  @Get(":id")
  @ApiKeyScope("jobs:read")
  get(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser): Promise<JobDto> {
    return this.jobs.get(id, actor);
  }

  @Post()
  @ApiKeyScope("jobs:write")
  @Roles("OWNER", "DISPATCHER")
  @ApiZodBody(jobCreateSchema)
  create(
    @Body(new ZodValidationPipe(jobCreateSchema)) body: JobCreateData,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobDto> {
    return this.jobs.create(body, actor);
  }

  /** Drag-and-drop on the board: assign technician + time (REQUESTED jobs become SCHEDULED). */
  @Post(":id/schedule")
  @ApiKeyScope("jobs:write")
  @HttpCode(200)
  @Roles("OWNER", "DISPATCHER")
  @ApiZodBody(scheduleJobSchema)
  schedule(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(scheduleJobSchema)) body: ScheduleJobData,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobDto> {
    return this.jobs.schedule(id, body, actor);
  }

  @Put(":id")
  @ApiKeyScope("jobs:write")
  @Roles("OWNER", "DISPATCHER")
  @ApiZodBody(jobUpdateSchema)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(jobUpdateSchema)) body: JobUpdateData,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobDto> {
    return this.jobs.update(id, body, actor);
  }

  /** The only way to change a job's status. Rules live in @opsdesk/shared's state machine. */
  @Post(":id/transitions")
  @ApiKeyScope("jobs:write")
  @HttpCode(200)
  @ApiZodBody(jobTransitionSchema)
  transition(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(jobTransitionSchema)) body: JobTransitionInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobDto> {
    return this.jobs.transition(id, body, actor);
  }
}
