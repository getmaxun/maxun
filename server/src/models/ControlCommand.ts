import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../storage/db';

export type ControlCommandStatus = 'running' | 'completed' | 'cancelled' | 'unknown';
export type ControlCommandMode = 'assist' | 'record';

export interface ControlCommandAttributes {
  id: string;
  userId: number;
  browserSessionId: string;
  ownerSessionId: string;
  actor: 'agent' | 'human';
  controlEpoch: number;
  commandId: string;
  commandType: string;
  mode: ControlCommandMode;
  status: ControlCommandStatus;
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date | null;
}

type ControlCommandCreationAttributes = Optional<ControlCommandAttributes, 'id' | 'createdAt' | 'updatedAt' | 'finishedAt'>;

class ControlCommand extends Model<ControlCommandAttributes, ControlCommandCreationAttributes> implements ControlCommandAttributes {
  public id!: string;
  public userId!: number;
  public browserSessionId!: string;
  public ownerSessionId!: string;
  public actor!: 'agent' | 'human';
  public controlEpoch!: number;
  public commandId!: string;
  public commandType!: string;
  public mode!: ControlCommandMode;
  public status!: ControlCommandStatus;
  public createdAt!: Date;
  public updatedAt!: Date;
  public finishedAt!: Date | null;
}

ControlCommand.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    browserSessionId: { type: DataTypes.STRING(255), allowNull: false },
    ownerSessionId: { type: DataTypes.STRING(255), allowNull: false },
    actor: { type: DataTypes.STRING(16), allowNull: false },
    controlEpoch: { type: DataTypes.INTEGER, allowNull: false },
    commandId: { type: DataTypes.STRING(255), allowNull: false },
    commandType: { type: DataTypes.STRING(32), allowNull: false },
    mode: { type: DataTypes.STRING(16), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    finishedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'maxun_control_command',
    timestamps: true,
  },
);

export default ControlCommand;
