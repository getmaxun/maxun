import { Model, DataTypes, Optional } from 'sequelize';
import sequelize from '../storage/db';
import { WorkflowFile, Where, What, WhereWhatPair } from 'maxun-core';

interface RobotMeta {
  name: string;
  id: string;
  createdAt: string;
  pairs: number;
  updatedAt: string;
  params: any[];
}

interface RobotWorkflow {
  workflow: WhereWhatPair[];
}

interface RobotAttributes {
  id: string;
  userId?: number;
  recording_meta: RobotMeta;
  recording: RobotWorkflow;
  google_sheet_email?: string | null;
  google_sheet_name?: string | null;
  google_sheet_id?: string | null;
  google_access_token?: string | null;
  google_refresh_token?: string | null;
  airtable_base_id?: string | null; // Airtable Base ID
  airtable_table_name?: string | null; // Airtable Table Name
  airtable_api_key?: string | null; // Airtable API Key
  airtable_access_token?: string | null; // Airtable OAuth Access Token
  schedule?: ScheduleConfig | null;
}

interface ScheduleConfig {
  runEvery: number;
  runEveryUnit: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';
  startFrom: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
  atTimeStart?: string;
  atTimeEnd?: string;
  timezone: string;
  lastRunAt?: Date;
  nextRunAt?: Date;
  dayOfMonth?: string;
  cronExpression?: string;
}

interface RobotCreationAttributes extends Optional<RobotAttributes, 'id'> {}

class Robot extends Model<RobotAttributes, RobotCreationAttributes> implements RobotAttributes {
  public id!: string;
  public userId!: number;
  public recording_meta!: RobotMeta;
  public recording!: RobotWorkflow;
  public google_sheet_email!: string | null;
  public google_sheet_name?: string | null;
  public google_sheet_id?: string | null;
  public google_access_token!: string | null;
  public google_refresh_token!: string | null;
  public airtable_base_id!: string | null;
  public airtable_table_name!: string | null;
  public airtable_api_key!: string | null;
  public airtable_access_token!: string | null;
  public schedule!: ScheduleConfig | null;
}

Robot.init(
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
    recording_meta: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    recording: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    google_sheet_email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    google_sheet_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    google_sheet_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    google_access_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    google_refresh_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    airtable_base_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    airtable_table_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    airtable_api_key: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    airtable_access_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    schedule: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'robot',
    timestamps: false,
  }
);

// Uncomment and define relationships if needed
// Robot.hasMany(Run, {
//   foreignKey: 'robotId',
//   as: 'runs', // Alias for the relation
// });

export default Robot;
