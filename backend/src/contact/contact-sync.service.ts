import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../shared/database/prisma.service';
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';
import type { Prisma } from '../generated/prisma/client';

/** 同步状态（存 Redis，供前端轮询） */
export type ContactSyncStatus = {
  status: 'idle' | 'running' | 'success' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  departments?: number;
  users?: number;
  /** 成功拉到 CoreHR 详情的员工数 */
  corehrEmployees?: number;
  /** CoreHR 详情同步失败原因（不影响整体 success：未开通飞书人事/缺权限时降级） */
  corehrError?: string;
  /** 成功同步的薪资档案版本数 */
  compensationArchives?: number;
  /** 薪资档案同步失败原因（不影响整体 success：未开通薪酬/缺权限时降级） */
  compensationError?: string;
  error?: string;
};

const SYNC_LOCK_KEY = 'contact:sync:lock';
const SYNC_STATUS_KEY = 'contact:sync:status';
// 锁 30 分钟自动过期，防止进程异常退出后死锁。
const SYNC_LOCK_TTL_SECONDS = 1800;
// 飞书通讯录的虚拟根部门 ID。
const ROOT_DEPARTMENT_ID = '0';
// corehr.v2 employee.batchGet 单次最多 100 个 employment_ids（官方限制）。
const COREHR_BATCH_SIZE = 100;
// corehr.v2 employee.batchGet 单次最多查询 100 个 fields（官方限制）。
const COREHR_FIELD_BATCH_SIZE = 100;

/**
 * CoreHR batchGet 的完整 fields 查询列表。
 * 字段名来自官方「查询员工信息的字段格式参考」文档。
 * 总数超过接口单次 100 个 fields 的上限，调用时必须按 COREHR_FIELD_BATCH_SIZE
 * 分批查询并按员工合并响应。fields 为空时接口只返回 employment_id。
 */
const COREHR_EMPLOYEE_FIELDS = [
  // 基础雇佣信息
  'ats_application_id',
  'avatar_url',
  'company_id',
  'compensation_type',
  'contract_end_date',
  'contract_expected_end_date',
  'contract_start_date',
  'custom_fields',
  'custom_org_01',
  'custom_org_02',
  'custom_org_03',
  'custom_org_04',
  'custom_org_05',
  'department.name',
  'department_id',
  'effective_date',
  'email_address',
  'employee_number',
  'employee_type_id',
  'employment_id',
  'employment_status',
  'employment_type',
  'expiration_date',
  'external_id',
  'international_assignment',
  'noncompete_status',
  'on_probation',
  'past_offboarding',
  'pay_group_id',
  'prehire_id',
  'primary_contract_id',
  'primary_employment',
  'probation_end_date',
  'probation_period',
  'reason_for_offboarding',
  'recruitment_type',
  'regular_employee_start_date',
  'rehire',
  'rehire_employment_id',
  'seniority_date',
  'service_company',
  'tenure',
  'time_zone',
  'times_employed',
  'work_calendar_id',
  'work_email_list',
  'work_location_id',
  'work_shift',
  'working_hours_type_id',
  'cost_center_list',

  // 汇报关系：只查询工作邮箱、工号、常用名和员工 ID。
  'direct_manager.email_address',
  'direct_manager.employee_number',
  'direct_manager.person_info.preferred_english_full_name',
  'direct_manager.person_info.preferred_local_full_name',
  'direct_manager.person_info.preferred_name',
  'direct_manager_id',
  'dotted_line_manager.email_address',
  'dotted_line_manager.employee_number',
  'dotted_line_manager.person_info.preferred_english_full_name',
  'dotted_line_manager.person_info.preferred_local_full_name',
  'dotted_line_manager.person_info.preferred_name',
  'dotted_line_manager_id',

  // 职务：对象字段必须显式下钻，否则接口只返回 ID。
  'job.active',
  'job.code',
  'job.custom_fields',
  'job.description',
  'job.effective_time',
  'job.expiration_time',
  'job.id',
  'job.job_family_id_list',
  'job.job_level_id_list',
  'job.job_title',
  'job.name',
  'job.working_hours_type_id',
  'job_id',

  // 序列
  'job_family.active',
  'job_family.code',
  'job_family.custom_fields',
  'job_family.effective_time',
  'job_family.expiration_time',
  'job_family.id',
  'job_family.name',
  'job_family.parent_id',
  'job_family_id',

  // 职级 / 职等
  'job_grade_id',
  'job_level.active',
  'job_level.code',
  'job_level.custom_fields',
  'job_level.description',
  'job_level.id',
  'job_level.level_order',
  'job_level.name',
  'job_level_id',

  // 岗位
  'position.active',
  'position.code',
  'position.descriptions',
  'position.id',
  'position.names',

  // 个人档案
  'person_info.additional_nationalities',
  'person_info.address_list',
  'person_info.age',
  'person_info.bank_account_list',
  'person_info.born_country_region',
  'person_info.citizenship_status',
  'person_info.custom_fields',
  'person_info.date_entered_workforce',
  'person_info.date_of_birth',
  'person_info.dependent_list',
  'person_info.disable_card_number',
  'person_info.education_list',
  'person_info.email_address',
  'person_info.email_list',
  'person_info.emergency_contact_list',
  'person_info.family_address',
  'person_info.first_entry_time',
  'person_info.gender',
  'person_info.highest_degree_of_education',
  'person_info.highest_level_of_education',
  'person_info.hukou_location',
  'person_info.hukou_type',
  'person_info.is_disabled',
  'person_info.is_martyr_family',
  'person_info.is_old_alone',
  'person_info.leave_time',
  'person_info.legal_name',
  'person_info.marital_status',
  'person_info.martyr_card_number',
  'person_info.name_list',
  'person_info.national_id_list',
  'person_info.national_id_number',
  'person_info.nationality_id_v2',
  'person_info.native_region',
  'person_info.person_id',
  'person_info.personal_profile',
  'person_info.phone_list',
  'person_info.phone_number',
  'person_info.political_affiliations',
  'person_info.preferred_english_full_name',
  'person_info.preferred_local_full_name',
  'person_info.preferred_name',
  'person_info.profile_image_id',
  'person_info.race',
  'person_info.religion',
  'person_info.resident_taxes',
  'person_info.talent_id',
  'person_info.work_experience_list',
  'person_info.working_years',
];

/**
 * CoreHR 字段分批响应会携带本批未查询字段，并将其值设为 undefined。
 * 合并时只保留已定义属性，避免后批响应清空前批已经查询到的数据。
 */
const omitUndefinedProperties = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, propertyValue]) => propertyValue !== undefined,
    ),
  ) as T;

@Injectable()
export class ContactSyncService {
  private readonly logger = new Logger(ContactSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly larkService: LarkService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * 触发一次全量同步（异步执行，立即返回）。
   * Redis 分布式锁保证同一时刻只有一次同步在跑。
   */
  async triggerSync(): Promise<ContactSyncStatus> {
    const locked = await this.redis.set(
      SYNC_LOCK_KEY,
      new Date().toISOString(),
      'EX',
      SYNC_LOCK_TTL_SECONDS,
      'NX',
    );
    if (!locked) {
      throw new ConflictException('已有同步任务在执行中，请稍后再试');
    }

    const status: ContactSyncStatus = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await this.writeStatus(status);

    // 后台执行，不阻塞接口返回；结果通过 GET /contact/sync/status 查询。
    void this.runFullSync(status).finally(() => {
      void this.redis.del(SYNC_LOCK_KEY);
    });

    return status;
  }

  async getStatus(): Promise<ContactSyncStatus> {
    const raw = await this.redis.get(SYNC_STATUS_KEY);
    if (!raw) {
      return { status: 'idle' };
    }
    return JSON.parse(raw) as ContactSyncStatus;
  }

  private async writeStatus(status: ContactSyncStatus) {
    await this.redis.set(SYNC_STATUS_KEY, JSON.stringify(status));
  }

  /** 全量同步：先部门树和员工，再同步 CoreHR 详情与薪资档案。 */
  private async runFullSync(status: ContactSyncStatus) {
    try {
      const departmentIds = await this.syncDepartments();
      status.departments = departmentIds.length;

      const openIds = await this.syncUsers([
        ROOT_DEPARTMENT_ID,
        ...departmentIds,
      ]);
      status.users = openIds.length;

      // CoreHR 详情属于增强数据：失败（未开通飞书人事/缺 corehr:employee:read 权限）
      // 只记录 corehrError 并降级，不影响部门/员工基础数据的同步结果。
      try {
        status.corehrEmployees = await this.syncCorehrEmployees(openIds);
      } catch (corehrError) {
        status.corehrError =
          corehrError instanceof Error
            ? corehrError.message
            : String(corehrError);
        this.logger.warn(
          `CoreHR 员工详情同步失败（已降级，仅保留通讯录数据）：${status.corehrError}`,
        );
      }

      // 薪资档案属于敏感增强数据：未开通薪酬或缺少薪资档案资源权限时独立降级。
      try {
        status.compensationArchives =
          await this.syncCompensationArchives(openIds);
      } catch (compensationError) {
        status.compensationError =
          compensationError instanceof Error
            ? compensationError.message
            : String(compensationError);
        this.logger.warn(
          `员工薪资档案同步失败（已降级）：${status.compensationError}`,
        );
      }

      status.status = 'success';
      status.finishedAt = new Date().toISOString();
      this.logger.log(
        `组织架构同步完成：部门 ${status.departments} 个，员工 ${status.users} 人` +
          (status.corehrEmployees !== undefined
            ? `，CoreHR 详情 ${status.corehrEmployees} 人`
            : '') +
          (status.compensationArchives !== undefined
            ? `，薪资档案 ${status.compensationArchives} 个版本`
            : ''),
      );
    } catch (error) {
      status.status = 'failed';
      status.finishedAt = new Date().toISOString();
      status.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`组织架构同步失败：${status.error}`);
    } finally {
      await this.writeStatus(status);
    }
  }

  /**
   * 同步全部部门：department.children + fetch_child=true 一次性递归整棵树。
   * 返回同步到的 open_department_id 列表（不含虚拟根部门）。
   */
  private async syncDepartments(): Promise<string[]> {
    const client = this.larkService.getClient();
    const departmentIds: string[] = [];

    const iterator = await client.contact.v3.department.childrenWithIterator({
      path: { department_id: ROOT_DEPARTMENT_ID },
      params: {
        // 固定 ID 类型，保证与 lark_departments/lark_users 表主键口径一致。
        user_id_type: 'open_id',
        department_id_type: 'open_department_id',
        fetch_child: true,
        page_size: 50,
      },
    });

    for await (const page of iterator) {
      for (const item of page?.items ?? []) {
        if (!item.open_department_id) {
          continue;
        }
        departmentIds.push(item.open_department_id);

        // 字段与 SDK contact.v3 department 定义一一对应；嵌套结构原样存 JSONB。
        const data = {
          department_id: item.department_id,
          name: item.name,
          i18n_name: (item.i18n_name ?? undefined) as
            Prisma.InputJsonValue | undefined,
          parent_department_id: item.parent_department_id,
          leader_user_id: item.leader_user_id,
          chat_id: item.chat_id,
          order: item.order,
          unit_ids: item.unit_ids ?? [],
          member_count: item.member_count,
          status: (item.status ?? undefined) as
            Prisma.InputJsonValue | undefined,
          leaders: (item.leaders ?? undefined) as
            Prisma.InputJsonValue | undefined,
          group_chat_employee_types: item.group_chat_employee_types ?? [],
          department_hrbps: item.department_hrbps ?? [],
          primary_member_count: item.primary_member_count,
        };

        await this.prisma.larkDepartment.upsert({
          where: { open_department_id: item.open_department_id },
          create: {
            open_department_id: item.open_department_id,
            ...data,
            name: item.name ?? '',
            parent_department_id:
              item.parent_department_id ?? ROOT_DEPARTMENT_ID,
          },
          update: data,
        });
      }
    }

    return departmentIds;
  }

  /**
   * 同步员工：逐部门调用 user.findByDepartment（官方替代已废弃的 user.list），
   * 按 open_id 去重后 upsert。返回去重后的员工 open_id 列表（供 CoreHR 详情同步复用）。
   */
  private async syncUsers(departmentIds: string[]): Promise<string[]> {
    const client = this.larkService.getClient();
    const seen = new Set<string>();

    for (const departmentId of departmentIds) {
      const iterator =
        await client.contact.v3.user.findByDepartmentWithIterator({
          params: {
            user_id_type: 'open_id',
            department_id_type: 'open_department_id',
            department_id: departmentId,
            page_size: 50,
          },
        });

      for await (const page of iterator) {
        for (const item of page?.items ?? []) {
          if (!item.open_id || seen.has(item.open_id)) {
            continue;
          }
          seen.add(item.open_id);

          // 字段与 SDK contact.v3 user 定义一一对应；嵌套结构原样存 JSONB。
          const data = {
            union_id: item.union_id,
            user_id: item.user_id,
            name: item.name,
            en_name: item.en_name,
            nickname: item.nickname,
            email: item.email,
            mobile: item.mobile,
            mobile_visible: item.mobile_visible,
            gender: item.gender,
            avatar: (item.avatar ?? undefined) as
              Prisma.InputJsonValue | undefined,
            status: (item.status ?? undefined) as
              Prisma.InputJsonValue | undefined,
            department_ids: item.department_ids ?? [],
            leader_user_id: item.leader_user_id,
            city: item.city,
            country: item.country,
            work_station: item.work_station,
            join_time: item.join_time,
            is_tenant_manager: item.is_tenant_manager,
            employee_no: item.employee_no,
            employee_type: item.employee_type,
            positions: (item.positions ?? undefined) as
              Prisma.InputJsonValue | undefined,
            orders: (item.orders ?? undefined) as
              Prisma.InputJsonValue | undefined,
            custom_attrs: (item.custom_attrs ?? undefined) as
              Prisma.InputJsonValue | undefined,
            enterprise_email: item.enterprise_email,
            time_zone: item.time_zone,
            description: item.description,
            job_title: item.job_title,
            geo: item.geo,
            job_level_id: item.job_level_id,
            job_family_id: item.job_family_id,
            // assign_info 仅 user.get 接口返回，findByDepartment 不含该字段，留空。
            department_path: (item.department_path ?? undefined) as
              Prisma.InputJsonValue | undefined,
            dotted_line_leader_user_ids: item.dotted_line_leader_user_ids ?? [],
          };

          await this.prisma.larkUser.upsert({
            where: { open_id: item.open_id },
            create: {
              open_id: item.open_id,
              ...data,
              name: item.name ?? '',
            },
            update: data,
          });
        }
      }
    }

    return [...seen];
  }

  /**
   * 用 CoreHR（飞书人事）详情补全员工信息：
   * corehr.v2.employee.batchGet 按 open_id 分批（单批上限 100）拉取，
   * fields 见 COREHR_EMPLOYEE_FIELDS。返回成功入库的员工数。
   * 注意：接口限频 100 次/分钟；未录入 CoreHR 的账号（机器人/外部联系人）不会出现在响应里，属正常现象。
   */
  private async syncCorehrEmployees(openIds: string[]): Promise<number> {
    const client = this.larkService.getClient();
    let synced = 0;

    for (let i = 0; i < openIds.length; i += COREHR_BATCH_SIZE) {
      const batch = openIds.slice(i, i + COREHR_BATCH_SIZE);

      type CorehrBatchGetResponse = Awaited<
        ReturnType<typeof client.corehr.v2.employee.batchGet>
      >;
      const responses: CorehrBatchGetResponse[] = [];
      for (
        let fieldIndex = 0;
        fieldIndex < COREHR_EMPLOYEE_FIELDS.length;
        fieldIndex += COREHR_FIELD_BATCH_SIZE
      ) {
        responses.push(
          await client.corehr.v2.employee.batchGet({
            data: {
              fields: COREHR_EMPLOYEE_FIELDS.slice(
                fieldIndex,
                fieldIndex + COREHR_FIELD_BATCH_SIZE,
              ),
              employment_ids: batch,
            },
            params: {
              // 与 lark_users / lark_departments 主键口径保持一致。
              user_id_type: 'open_id',
              department_id_type: 'open_department_id',
            },
          }),
        );
      }

      const responseItems = responses.flatMap(
        (response) => response?.data?.items ?? [],
      );
      const mergedItems = new Map<string, (typeof responseItems)[number]>();

      for (const item of responseItems) {
        if (!item.employment_id) {
          continue;
        }
        const previous = mergedItems.get(item.employment_id);
        const definedItem = omitUndefinedProperties(item);
        const definedPersonInfo = item.person_info
          ? omitUndefinedProperties(item.person_info)
          : undefined;
        mergedItems.set(item.employment_id, {
          ...previous,
          ...definedItem,
          // person_info 等对象可能被 fields 分批切开，必须深一层合并。
          person_info: {
            ...previous?.person_info,
            ...definedPersonInfo,
          },
        });
      }

      for (const item of mergedItems.values()) {
        // user_id_type=open_id 时 employment_id 即员工 open_id。
        const openId = item.employment_id;
        if (!openId) {
          continue;
        }

        // 字段与 SDK corehr.v2 employee 定义一一对应；枚举/嵌套结构原样存 JSONB。
        const data = {
          employment_id_v2: item.employment_id_v2,
          employee_number: item.employee_number,
          employee_type_id: item.employee_type_id,
          employee_subtype_id: item.employee_subtype_id,
          employment_type: (item.employment_type ?? undefined) as
            Prisma.InputJsonValue | undefined,
          employment_status: (item.employment_status ?? undefined) as
            Prisma.InputJsonValue | undefined,
          effective_date: item.effective_date,
          expiration_date: item.expiration_date,
          reason_for_offboarding: (item.reason_for_offboarding ?? undefined) as
            Prisma.InputJsonValue | undefined,
          primary_employment: item.primary_employment,
          department_id: item.department_id,
          company_id: item.company_id,
          work_location_id: item.work_location_id,
          working_hours_type_id: item.working_hours_type_id,
          cost_center_list: (item.cost_center_list ?? undefined) as
            Prisma.InputJsonValue | undefined,
          job_level_id: item.job_level_id,
          job_level: (item.job_level ?? undefined) as
            Prisma.InputJsonValue | undefined,
          job_grade_id: item.job_grade_id,
          job_family_id: item.job_family_id,
          job_family: (item.job_family ?? undefined) as
            Prisma.InputJsonValue | undefined,
          position_id: item.position_id,
          position: (item.position ?? undefined) as
            Prisma.InputJsonValue | undefined,
          job_id: item.job_id,
          job: (item.job ?? undefined) as Prisma.InputJsonValue | undefined,
          direct_manager_id: item.direct_manager_id,
          dotted_line_manager_id: item.dotted_line_manager_id,
          tenure: item.tenure,
          seniority_date: item.seniority_date,
          probation_period: item.probation_period,
          on_probation: item.on_probation,
          probation_end_date: item.probation_end_date,
          regular_employee_start_date: item.regular_employee_start_date,
          rehire: (item.rehire ?? undefined) as
            Prisma.InputJsonValue | undefined,
          contract_start_date: item.contract_start_date,
          contract_end_date: item.contract_end_date,
          contract_expected_end_date: item.contract_expected_end_date,
          email_address: item.email_address,
          work_email_list: (item.work_email_list ?? undefined) as
            Prisma.InputJsonValue | undefined,
          avatar_url: item.avatar_url,
          time_zone: item.time_zone,
          custom_fields: (item.custom_fields ?? undefined) as
            Prisma.InputJsonValue | undefined,
          person_info: (item.person_info ?? undefined) as
            Prisma.InputJsonValue | undefined,
        };

        await this.prisma.larkCorehrEmployee.upsert({
          where: { open_id: openId },
          create: { open_id: openId, ...data },
          update: data,
        });
        synced += 1;
      }
    }

    return synced;
  }

  /**
   * 同步员工薪资档案：按 open_id 每 100 人一批，并完整遍历接口分页。
   * tid 是档案版本唯一标识，同一员工可有多个历史版本。
   */
  private async syncCompensationArchives(openIds: string[]): Promise<number> {
    const client = this.larkService.getClient();
    const syncedTids = new Set<string>();

    for (let i = 0; i < openIds.length; i += COREHR_BATCH_SIZE) {
      const batch = openIds.slice(i, i + COREHR_BATCH_SIZE);
      let pageToken: string | undefined;
      const seenPageTokens = new Set<string>();

      do {
        const response = await client.compensation.v1.archive.query({
          data: { user_id_list: batch },
          params: {
            page_size: 500,
            user_id_type: 'open_id',
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
        if (response?.code !== undefined && response.code !== 0) {
          throw new Error(
            `薪资档案接口返回错误 ${response.code}: ${response.msg ?? 'unknown error'}`,
          );
        }

        for (const item of response?.data?.items ?? []) {
          // SDK 标记为必填；运行时仍做保护，避免异常脏数据破坏整批同步。
          if (!item.user_id || !item.id || !item.tid || !item.effective_date) {
            this.logger.warn(
              '跳过缺少 user_id/id/tid/effective_date 的薪资档案',
            );
            continue;
          }

          const data = {
            id: item.id,
            open_id: item.user_id,
            plan_id: item.plan_id,
            plan_tid: item.plan_tid,
            currency_id: item.currency_id,
            change_reason_id: item.change_reason_id,
            change_description: item.change_description,
            effective_date: item.effective_date,
            expiration_date: item.expiration_date,
            salary_level_id: item.salary_level_id,
            created_time: item.created_time,
            updated_time: item.updated_time,
            archive_items: (item.archive_items ?? undefined) as
              Prisma.InputJsonValue | undefined,
            archive_indicators: (item.archive_indicators ?? undefined) as
              Prisma.InputJsonValue | undefined,
          };

          await this.prisma.larkCompensationArchive.upsert({
            where: { tid: item.tid },
            create: { tid: item.tid, ...data },
            update: data,
          });
          syncedTids.add(item.tid);
        }

        if (!response?.data?.has_more) {
          break;
        }
        const nextPageToken = response.data.page_token;
        if (!nextPageToken || seenPageTokens.has(nextPageToken)) {
          throw new Error('薪资档案分页响应缺少有效的新 page_token');
        }
        seenPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
      } while (pageToken);
    }

    return syncedTids.size;
  }
}
