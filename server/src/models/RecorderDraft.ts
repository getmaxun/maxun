import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../storage/db';

export type RecorderDraftStatus = 'discovered' | 'compiled' | 'failed';

export interface DraftFieldState {
  id: string;
  sourceLabel: string;
  label: string;
  selector: string;
  attribute: string;
  tag: string;
  isShadow: boolean;
  samples: string[];
  included: boolean;
}

export interface DraftListState {
  id: string;
  selector: string;
  tag: string;
  count: number;
  semanticParent: string;
  sampleTexts: string[];
  attributes: string[];
  fields: DraftFieldState[];
  pagination: {
    type: string;
    selector: string;
    tested: boolean;
  };
}

export interface RecorderDraftState {
  lists: DraftListState[];
  selectedListId?: string;
  limit?: number | null;
}

export interface RecorderDraftAttributes {
  id: string;
  userId: number;
  url: string;
  name: string;
  description?: string | null;
  status: RecorderDraftStatus;
  state: RecorderDraftState;
  compiledRobotId?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type RecorderDraftCreationAttributes = Optional<
  RecorderDraftAttributes,
  'id' | 'description' | 'compiledRobotId' | 'lastError' | 'createdAt' | 'updatedAt'
>;

class RecorderDraft extends Model<RecorderDraftAttributes, RecorderDraftCreationAttributes> implements RecorderDraftAttributes {
  public id!: string;
  public userId!: number;
  public url!: string;
  public name!: string;
  public description!: string | null;
  public status!: RecorderDraftStatus;
  public state!: RecorderDraftState;
  public compiledRobotId!: string | null;
  public lastError!: string | null;
  public createdAt!: Date;
  public updatedAt!: Date;
}

RecorderDraft.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'discovered',
    },
    state: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    compiledRobotId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'recorder_draft',
    timestamps: false,
    indexes: [
      { fields: ['userId'] },
      { fields: ['userId', 'updatedAt'] },
    ],
  },
);

export default RecorderDraft;
