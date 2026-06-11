// Erreur métier portant son statut HTTP — module pur (aucune dépendance) :
// utilisable par les modules serveur non liés à Next (jobs.ts) et testable.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
