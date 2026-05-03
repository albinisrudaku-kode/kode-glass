import {analyzeCurrentPage} from '../shared/engines/accessibility-engine';

interface KodeGlassAnalyzerGlobal {
	__kodeGlassAnalyzeCurrentPage?: typeof analyzeCurrentPage;
}

(globalThis as KodeGlassAnalyzerGlobal).__kodeGlassAnalyzeCurrentPage = analyzeCurrentPage;