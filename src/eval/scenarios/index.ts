import { TestScenario } from '../types';
import scenarioOne from './scenario-one';
import scenarioGather from './scenario-gather';

const SCENARIOS = new Map<string, TestScenario>([
    [scenarioOne.id, scenarioOne],
    [scenarioGather.id, scenarioGather],
]);

export function getScenario(id: string): TestScenario | undefined {
    return SCENARIOS.get(id);
}

export function getAllScenarioIds(): string[] {
    return [...SCENARIOS.keys()];
}
