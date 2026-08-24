export interface BackNavigation<Fallback> {
  canGoBack?: () => boolean;
  back: () => void;
  replace: (path: Fallback) => void;
}

export function navigateBackOr<Fallback>(
  navigation: BackNavigation<Fallback>,
  fallback: Fallback,
): 'back' | 'fallback' {
  if (navigation.canGoBack?.()) {
    navigation.back();
    return 'back';
  }

  navigation.replace(fallback);
  return 'fallback';
}
