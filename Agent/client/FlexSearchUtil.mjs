import FlexSearch, { Document as DocumentExport } from 'flexsearch';

const Document = DocumentExport || FlexSearch?.Document;

if (!Document) {
  throw new Error('FlexSearch Document export is unavailable.');
}

const DEFAULT_LIMIT = 5;
const FIELD_WEIGHTS = Object.freeze({
  feedbackTitle: 2,
  taskDescription: 1,
});

export default class FlexSearchUtil {
  constructor() {
    this.index = new Document({
      document: {
        id: 'taskId',
        index: [
          { field: 'feedbackTitle', tokenize: 'forward' },
          { field: 'taskDescription', tokenize: 'full' },
        ],
        store: ['taskId', 'feedbackTitle', 'taskDescription'],
      },
    });

    this.documents = new Map();
  }

  register(taskId, feedbackTitle, taskDescription) {
    if (taskId === undefined || taskId === null || taskId === '') {
      throw new Error('taskId is required to register feedback');
    }

    const id = `${taskId}`;
    const entry = {
      taskId: id,
      feedbackTitle: feedbackTitle ?? '',
      taskDescription: taskDescription ?? '',
    };

    this.documents.set(id, entry);
    this.index.add(entry);

    return entry;
  }

  rank(text, top = DEFAULT_LIMIT) {
    const query = typeof text === 'string' ? text.trim() : '';
    if (!query) {
      return [];
    }

    const limit = Number.isInteger(top) && top > 0 ? top : DEFAULT_LIMIT;
    const resolvedResults = this.index.search(query, {
      limit,
      enrich: true,
      resolve: true,
    });

    const aggregated = new Map();

    const processEntry = (field, entry, rankPosition) => {
      if (!entry) return;

      const id = typeof entry === 'object'
        ? entry.id ?? entry.doc?.taskId
        : `${entry}`;
      if (!id) return;

      const stored = entry.doc ?? this.documents.get(id);
      if (!stored) return;

      const weight = FIELD_WEIGHTS[field] ?? 1;
      const scoreContribution = weight / (rankPosition + 1);

      const current = aggregated.get(id) || {
        taskId: stored.taskId ?? id,
        feedbackTitle: stored.feedbackTitle ?? '',
        taskDescription: stored.taskDescription ?? '',
        score: 0,
      };

      current.score += scoreContribution;
      aggregated.set(id, current);
    };

    if (Array.isArray(resolvedResults)) {
      for (const fieldResult of resolvedResults) {
        if (!fieldResult || !fieldResult.result) continue;

        const fieldName = fieldResult.field ?? 'taskDescription';
        const hits = fieldResult.result;
        if (!Array.isArray(hits)) continue;

        hits.forEach((entry, index) => processEntry(fieldName, entry, index));
      }
    }

    return Array.from(aggregated.values())
      .sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId))
      .slice(0, limit)
      .map(({ taskId, feedbackTitle, taskDescription, score }) => ({
        [taskId]: {
          feedbackTitle,
          taskDescription,
          score,
        },
      }));
  }
}
