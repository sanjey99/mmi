import { installRuntimeMonitoring } from './runtimeReporter';
import { reportRuntimeEvent } from './runtimeService';

// index.js loads the email-link scrubber first. Do not move this ahead of it.
if (typeof window !== 'undefined') installRuntimeMonitoring(window, reportRuntimeEvent);
