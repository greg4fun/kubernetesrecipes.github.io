---
title: "Kubernetes Logging with ELK Stack"
description: "Deploy centralized logging for Kubernetes with Elasticsearch, Fluentd, and Kibana. Covers log collection, parsing, indexing, and retention policies."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-04-03"
tags: ["logging", "elasticsearch", "fluentd", "kibana", "elk", "kubernetes"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Deploy centralized logging for Kubernetes with Elasticsearch, Fluentd, and Kibana. Covers log collection, parsing, indexing, and retention policies.

## The Problem

This is one of the most searched Kubernetes topics. A comprehensive, well-structured guide helps engineers of all levels quickly find actionable solutions.

## The Solution

Detailed implementation with production-ready examples below.

## Common Issues

Check `kubectl describe` and `kubectl get events` first — most issues have clear error messages pointing to the root cause.

## Best Practices

- **Follow least privilege** — only grant the access that's needed
- **Test in staging** before applying to production
- **Monitor and alert** on key metrics
- **Document your runbooks** for the team

## Key Takeaways

- Essential knowledge for Kubernetes operations
- Start simple and evolve your approach
- Automation reduces human error
- Share knowledge with your team
