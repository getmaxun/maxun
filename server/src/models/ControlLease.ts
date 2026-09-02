import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../storage/db';

export type ControlActor = 'agent' | 'human';

export interface ControlLeaseAttributes {
  id: string;
  userId: number;
  browserSessionId: string;
  ownerSessionId: string;
  actor: ControlActor;
  controlEpoch: number;
  active: boolean;
  observationReady: boolean;
  expiresAt: Date;
  heartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type ControlLeaseCreationAttributes = Optional<ControlLeaseAttributes, 'id' | 'createdAt' | 'updatedAt'>;

class ControlLease extends Model<ControlLeaseAttributes, ControlLeaseCreationAttributes> implements ControlLeaseAttributes {
  public id!: string;
  public userId!: number;
  public browserSessionId!: string;
  public ownerSessionId!: string;
  public actor!: ControlActor;
  public controlEpoch!: number;
  public active!: boolean;
  public observationReady!: boolean;
  public expiresAt!: Date;
  public heartbeatAt!: Date;
  public createdAt!: Date;
  public updatedAt!: Date;
}

ControlLease.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    browserSessionId: { type: DataTypes.STRING(255), allowNull: false },
    ownerSessionId: { type: DataTypes.STRING(255), allowNull: false },
    actor: { type: DataTypes.STRING(16), allowNull: false },
    controlEpoch: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    observationReady: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    heartbeatAt: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'maxun_control_lease',
    indexes: [
      { unique: true, fields: ['userId', 'browserSessionId'], name: 'maxun_control_lease_browser_unique' },
      { fields: ['userId', 'ownerSessionId'], name: 'maxun_control_lease_owner_idx' },
    ],
    timestamps: true,
  },
);

export default ControlLease;
