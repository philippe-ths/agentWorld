import { FunctionRecord } from './GameConfig';
import { findUnsupportedFunctionReason } from './FunctionCapability';

export interface UnsupportedPersistedFunction {
    record: FunctionRecord;
    reason: string;
}

export function partitionPersistedFunctionRecords(records: FunctionRecord[]): {
    supported: FunctionRecord[];
    unsupported: UnsupportedPersistedFunction[];
} {
    const supported: FunctionRecord[] = [];
    const unsupported: UnsupportedPersistedFunction[] = [];

    for (const record of records) {
        const reason = findUnsupportedFunctionReason(record);
        if (reason) {
            unsupported.push({ record, reason });
            continue;
        }

        supported.push(record);
    }

    return { supported, unsupported };
}

export function buildRemovedFunctionNote(record: FunctionRecord, reason: string): string {
    return `System note: Code Forge removed function "${record.name}" because it was unsupported. ${reason}`;
}