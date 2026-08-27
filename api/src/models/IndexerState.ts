import mongoose, { Schema } from "mongoose";

/** Single doc: last processed block for Veiledhood `Deposited` logs. */
export interface IIndexerState {
  key: string;
  lastBlock: number;
}

const indexerStateSchema = new Schema<IIndexerState>(
  {
    key: { type: String, required: true, unique: true, default: "deposited" },
    lastBlock: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export const IndexerState =
  mongoose.models.IndexerState ??
  mongoose.model<IIndexerState>("IndexerState", indexerStateSchema);
