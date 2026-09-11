import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../storage/db';

export type ResourceClaimType = 'draft' | 'browser';

export interface ResourceClaimAttributes {
  id: string;
  userId: number;
  resourceType: ResourceClaimType;
  resourceId: string;
  ownerSessionId: string;
  epoch: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type ResourceClaimCreationAttributes = Optional<ResourceClaimAttributes, 'id' | 'createdAt' | 'updatedAt'>;

class ResourceClaim extends Model<ResourceClaimAttributes, ResourceClaimCreationAttributes> implements ResourceClaimAttributes {
  public id!: string;
  public userId!: number;
  public resourceType!: ResourceClaimType;
  public resourceId!: string;
  public ownerSessionId!: string;
  public epoch!: number;
  public active!: boolean;
  public createdAt!: Date;
  public updatedAt!: Date;
}

ResourceClaim.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    resourceType: { type: DataTypes.STRING(32), allowNull: false },
    resourceId: { type: DataTypes.STRING(255), allowNull: false },
    ownerSessionId: { type: DataTypes.STRING(255), allowNull: false },
    epoch: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'maxun_resource_claim',
    timestamps: true,
  },
);

export default ResourceClaim;
