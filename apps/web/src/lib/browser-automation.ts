import { chatServices } from './services';

/**
 * Browser Agent service (composed in `@tactia/chat`). Tasks are published to
 * pg-boss and run by the worker registered in `./jobs`.
 */
export const browserAutomationService = chatServices.browserAutomationService;
