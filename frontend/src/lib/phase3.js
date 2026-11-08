export const asList = (value) =>
  Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];

export const recordId = (record) => String(record?.id ?? record?._id ?? '');

export const entityName = (entity) => entity?.name || entity?.title || entity?.code || recordId(entity);
