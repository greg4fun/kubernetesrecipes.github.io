#!/bin/bash
# SEO Cleanup Script for kubernetes.recipes
# Run this script to remove duplicate content files

set -e

echo "🧹 Kubernetes Recipes SEO Cleanup"
echo "=================================="
echo ""

# Files to remove (duplicates that have been consolidated)
DUPLICATES=(
  "src/content/recipes/blue-green-deployments.md"
  "src/content/recipes/prometheus-monitoring.md"
  "src/content/recipes/argocd-gitops.md"
  "src/content/recipes/flux-gitops.md"
  "src/content/recipes/kubernetes-jobs-cronjobs.md"
  "src/content/recipes/keda-event-autoscaling.md"
  "src/content/recipes/container-logging.md"
  "src/content/recipes/downward-api.md"
  "src/content/recipes/kyverno-policies.md"
  "src/content/recipes/velero-backup-restore.md"
  "src/content/recipes/container-image-scanning.md"
)

echo "The following duplicate files will be removed:"
echo ""
for file in "${DUPLICATES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ❌ $file"
  else
    echo "  ✅ $file (already removed)"
  fi
done

echo ""
read -p "Do you want to proceed? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "Removing files..."
  
  for file in "${DUPLICATES[@]}"; do
    if [ -f "$file" ]; then
      rm "$file"
      echo "  ✓ Removed $file"
    fi
  done
  
  echo ""
  echo "✅ Cleanup complete!"
  echo ""
  echo "Next steps:"
  echo "  1. Run 'npm run build' to regenerate the site"
  echo "  2. Check the sitemap for removed URLs"
  echo "  3. Deploy to verify 404s are gone"
  echo "  4. Submit updated sitemap to Google Search Console"
  echo ""
else
  echo "Aborted."
fi
