/**
 * 旧版本地全量覆盖 store 已废弃：
 * 权威草稿改为服务端 draft 查询（带修订号、字段级合并），
 * 客户端只保留身份与失败操作 outbox，见 store/ui.ts。
 *
 * 浏览器中残留的 yy53-rights-draft-v1 持久数据不会再被读取；
 * 旧稿结构的迁移在服务端启动时由 lib/draft/migrate.ts 完成。
 */
export {}
