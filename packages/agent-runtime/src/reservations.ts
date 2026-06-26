import {
  BorealError,
  createRecordMeta,
  deterministicId,
  normalizeActorId,
  touchRecord,
  type ActorRef,
  type AgentId,
  type AgentReservation,
  type IsoTimestamp,
  type ReservationId,
  type RuntimePolicy,
  type WorkItem,
  withContentHash
} from "@boreal/core";

export interface ReserveWorkInput {
  readonly work: WorkItem;
  readonly agentId: AgentId | string;
  readonly existingReservationsForWork: readonly AgentReservation[];
  readonly activeReservationsForAgent: readonly AgentReservation[];
  readonly policy: Pick<RuntimePolicy, "allowReservationStealing" | "maxActiveReservationsPerAgent">;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
  readonly purpose?: string;
  readonly expiresAt?: IsoTimestamp;
  readonly force?: boolean;
  readonly forceReason?: string;
}

export interface ReserveWorkResult {
  readonly reservation: AgentReservation;
  readonly work: WorkItem;
  readonly releasedReservations: readonly AgentReservation[];
}

export interface RenewReservationInput {
  readonly reservation: AgentReservation;
  readonly expiresAt: IsoTimestamp;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function reserveWork(input: ReserveWorkInput): ReserveWorkResult {
  const agentId = normalizeActorId(String(input.agentId));
  if (input.work.status === "closed" || input.work.status === "cancelled") {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Closed or cancelled work cannot be reserved");
  }
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.parse(input.now)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reservation expiration must be in the future", {
      workId: input.work.meta.id,
      expiresAt: input.expiresAt,
      now: input.now
    });
  }

  const activeForWork = input.existingReservationsForWork.filter((reservation) => reservation.status === "active");
  if (activeForWork.length > 0 && !input.policy.allowReservationStealing) {
    throw new BorealError("BOREAL_CONFLICT", "Work already has an active reservation", {
      reservationIds: activeForWork.map((reservation) => reservation.meta.id)
    });
  }

  if (input.work.status !== "ready") {
    const forceReason = input.forceReason?.trim();
    if (!input.force || !forceReason) {
      throw new BorealError(
        "BOREAL_POLICY_VIOLATION",
        "Only ready work can be reserved without --force and --reason",
        {
          workId: input.work.meta.id,
          status: input.work.status
        }
      );
    }
  }

  if (input.activeReservationsForAgent.length >= input.policy.maxActiveReservationsPerAgent) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Agent has reached active reservation limit");
  }

  const releasedReservations = activeForWork.map((reservation) => releaseReservation(reservation, input.now, input.actor));
  const reservation = createReservation({ ...input, agentId });
  const work = touchRecord(
    {
      ...input.work,
      status: "reserved" as const,
      reservationId: reservation.meta.id
    },
    input.now,
    input.actor
  );

  return { reservation, work, releasedReservations };
}

export function releaseReservation(
  reservation: AgentReservation,
  now: IsoTimestamp,
  actor: ActorRef
): AgentReservation {
  return touchRecord({ ...reservation, status: "released" as const }, now, actor);
}

export function expireReservation(
  reservation: AgentReservation,
  now: IsoTimestamp,
  actor: ActorRef
): AgentReservation {
  return touchRecord({ ...reservation, status: "expired" as const }, now, actor);
}

export function renewReservation(input: RenewReservationInput): AgentReservation {
  if (input.reservation.status !== "active") {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Only active reservations can be renewed", {
      reservationId: input.reservation.meta.id,
      status: input.reservation.status
    });
  }
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reservation expiration must be in the future", {
      reservationId: input.reservation.meta.id,
      expiresAt: input.expiresAt,
      now: input.now
    });
  }
  return touchRecord({ ...input.reservation, expiresAt: input.expiresAt }, input.now, input.actor);
}

function createReservation(input: ReserveWorkInput): AgentReservation {
  const agentId = normalizeActorId(String(input.agentId));
  const id = deterministicId<ReservationId>("reservation", {
    workId: input.work.meta.id,
    agentId,
    reservedAt: input.now,
    purpose: input.purpose ?? null
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    workId: input.work.meta.id,
    agentId,
    status: "active",
    reservedAt: input.now,
    expiresAt: input.expiresAt,
    purpose: input.purpose
  });
}
